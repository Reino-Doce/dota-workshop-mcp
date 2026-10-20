import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";

/** Disposable certificates, generated locally; no private keys are committed. */
export async function testCertificates() {
  const directory = await mkdtemp(join(tmpdir(), "dota-mcp-tls-"));
  const close = async () => {
    if (!basename(directory).startsWith("dota-mcp-tls-") || dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected test directory.");
    await rm(directory, { recursive: true, force: true });
  };
  try {
  const openssl = process.env.OPENSSL ?? "openssl";
  const run = (...args: string[]) => execFileSync(openssl, args, { cwd: directory, stdio: "pipe", windowsHide: true });
  run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1", "-subj", "/CN=DotaMcpTestCA", "-keyout", "ca.key", "-out", "ca.pem");
  await writeFile(join(directory, "index.txt"), "");
  await writeFile(join(directory, "serial"), "1000\n");
  await writeFile(join(directory, "ca.cnf"), "[ca]\ndefault_ca=testca\n[testca]\ndatabase=index.txt\nserial=serial\nnew_certs_dir=.\ncertificate=ca.pem\nprivate_key=ca.key\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n");
  const clients: Record<string, { key: Buffer; cert: Buffer; fingerprint256: string }> = {};
  for (const name of ["server", "viewer", "operator", "admin", "outsider", "expired"]) {
    run("req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-subj", `/CN=${name}`, "-keyout", `${name}.key`, "-out", `${name}.csr`);
    await writeFile(join(directory, `${name}.ext`), name === "server"
      ? "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n"
      : "extendedKeyUsage=clientAuth\n");
    if (name === "expired") {
      run("ca", "-batch", "-config", "ca.cnf", "-in", `${name}.csr`, "-out", `${name}.pem`,
        "-startdate", "20000101000000Z", "-enddate", "20000102000000Z", "-notext", "-extfile", `${name}.ext`);
    } else {
      run("x509", "-req", "-in", `${name}.csr`, "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
        "-out", `${name}.pem`, "-days", "1", "-sha256", "-extfile", `${name}.ext`);
    }
    const cert = await readFile(join(directory, `${name}.pem`));
    clients[name] = { key: await readFile(join(directory, `${name}.key`)), cert, fingerprint256: new X509Certificate(cert).fingerprint256 };
  }
  return {
    directory, clients, ca: await readFile(join(directory, "ca.pem")),
    server: { key: join(directory, "server.key"), cert: join(directory, "server.pem"), ca: join(directory, "ca.pem"), requireClientCertificate: true },
    close,
  };
  } catch (error) {
    await close();
    throw error;
  }
}
