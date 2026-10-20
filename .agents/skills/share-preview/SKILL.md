---
name: share-preview
description: Preview Dota assets, share an interactive gallery for asset selection, or record game motion as a GIF. Use when the user asks to see particles, models, textures or sounds, choose assets, browse them on another device, or capture a short clip.
---

# Preview, share and record Dota assets

## Choose the workflow

Check that the Dota Workshop MCP tools needed for the chosen workflow are available.
If they are missing, explain which connection is needed instead of inventing tool names.
For detailed behavior, read the MCP resource `dota://guide/sharing` when available.

| Intent | Tools | Output |
| --- | --- | --- |
| Preview textures, particles or models | `asset_preview` | Numbered image montage and local HTML |
| Preview sounds | `sound_preview` | Sound montage and local HTML |
| Browse models, hear sounds or choose assets | `preview_studio` | Interactive gallery URL and asset manifest |
| Capture motion from the running game | `dota_record` | Local GIF artifact |

## Preview assets

1. Search with `asset_preview` using `{"query":"spark","kind":"particle"}`, or
   `sound_preview` using `{"query":"explosion"}`.
2. Present the returned image and identify the numbered assets. Use the returned local
   HTML path if the client cannot display the image.
3. State the relevant limits: particle previews show sprites rather than engine-rendered
   animation; models need the interactive gallery for 3D viewing; MP3 previews use a
   speaker tile and duration, while PCM/WAV can provide a waveform.

Decoding uses ValveResourceFormat without launching Dota. The tools may install their
decoder on first use. Assets come from the reference-game corpus; use `workshop_download`
or `ref_harvest` when the user wants to expand it.

## Browse, select or share a gallery

1. Run `preview_studio` with `{"query":"tower","share":false}` for local browsing.
   Use `share:true` when the user requests a public link or access from another device.
   The resulting Cloudflare URL is public: anyone with the link can view the gallery.
2. Present the URL returned by the tool and explain the asset IDs on the gallery cards.
   Use that response as the URL source; it changes when the gallery restarts.
3. Read submitted choices with `preview_selections`, or resolve IDs supplied in chat
   with `preview_pick`, for example `{"ids":"M3,P7"}`.
4. Run `preview_studio_stop` when the user has finished browsing.

Gallery particles approximate motion with billboards and particle parameters; they are
not engine renders. Models may lack textures when their source archive does not include
the materials they reference.

## Record motion

1. Use `dota_record` with `{"seconds":5,"fps":12,"width":480,"target":"game"}` for a
   short clip of the selected game window. Use `target:"screen"` only when the user
   requests the whole desktop. Recording brings the game window to the foreground.
2. Present the returned absolute GIF path with the client's supported attachment,
   preview or local-file link. Playback depends on the client; report animation as
   viewed only if it actually played. A remote client needs access to the artifact host.
3. If recording fails, report the tool error and use `dota_diagnose` to investigate
   a blocked game before retrying.

Recording uses ffmpeg, which may be installed on first use, and requires a windowed or
borderless game. Keep clips short and reduce frame rate for longer recordings.
Use available client capabilities for file delivery rather than assuming a particular
file-reading or file-sending tool. Publish a gallery only when the user wants sharing.
