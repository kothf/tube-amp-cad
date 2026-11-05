# Short-link store, and the owner's projects

`File ▾ → Share link…` in the CAD packs the design into text (see `cad-share.js`). On
aerocat.tech the app also sends that text here and gets a 10-character id back, so the link is
`https://aerocat.tech/s/<id>`. Elsewhere, or when this store can't be reached, the app gives the
long self-contained link instead.

- `server.mjs`: the store (Node only, no packages). It also keeps the site owner's projects and
  their revisions (`revisions.mjs`, `/api/rev/`, see below). Keeps each design once, named by its SHA-256,
  and only text that unpacks to a Tube Amp CAD design. Limits: 96k characters a design, 100 MB in
  all (`MAX_TEXT`, `MAX_TOTAL`); past that the designs shared longest ago are deleted to make room
  (sharing one again makes it the newest); POSTs only from `ORIGINS`.
- `docker-compose.yml`: runs it on the internal network `share`, no published port.
- `nginx.conf`: the `/s/<id>` redirect, the `/api/share` proxy and a rate limit, to add to the
  site's nginx.

Install on the NUC (the site's compose lists `share` as an external network, so bring the store up
before recreating the site, and don't `docker compose down` it while the site is up):

```sh
mkdir -p ~/tubecad-share && cp server.mjs Dockerfile docker-compose.yml ~/tubecad-share/
cd ~/tubecad-share && mkdir -p data && sudo chown 1000:1000 data && docker compose up -d --build
docker network connect share aerocat_static_web     # or add the network in ~/aerocat/docker-compose.yml
# add nginx.conf's lines to ~/aerocat/nginx.conf, then: docker exec aerocat_static_web nginx -s reload
curl -s https://aerocat.tech/api/share/health
```

## Projects and revisions (owner only)

`File ▾ → Revisions…` in the CAD and the project manager (`projects.html`) keep each project's
revisions here, in `./revisions` (one folder a project: `project.json` and `<n>.json.gz`). Only the
site's owner gets in:

1. **Cloudflare Access** in front of `aerocat.tech/api/rev`: in Zero Trust → Access → Applications,
   edit the Freerouting application (its policy already admits only you) and add a public
   hostname `aerocat.tech` with path `api/rev`; or make a new self-hosted application for that path
   with the same policy.
2. **The store checks the Access token itself** (`access.mjs`): signed by the team's keys
   (`ACCESS_TEAM`, in `docker-compose.yml`), issued by the team, not expired. Optionally, in a
   `.env` file next to `docker-compose.yml`: `ACCESS_AUD=<the application's Audience tag>` and
   `ACCESS_EMAILS=<your e-mail>`. Without `ACCESS_TEAM` everyone is refused.
3. Changes (POST, PATCH, DELETE) only from pages on `ORIGINS`.

Space: links and revisions share `MAX_TOTAL` (100 MB). A new revision makes room by deleting the
oldest links; revisions are never deleted except by you. `MAX_REVISIONS` and `MAX_SHARES` cap each
part (both 100 MB by default, so revisions may take it all). The manager shows what is used.

Deleting a project or a revision moves it to the trash (it keeps its files and its room); the
trash is emptied after `TRASH_DAYS` (30) days, or by hand in the manager. `POST /api/rev/import`
takes a project as `/export` writes it (the manager's Import project…).

## Backups

The NUC copies the store to the desktop: `~/scripts/tubecad-backup.sh` (from the NUC user's
crontab, 03:20 and 15:20 and after a reboot) writes `tubecad_<time>.tar.gz` and its SHA-256 to
`/mnt/Projects/tubecad-backup/snapshots/` (the desktop's Samba share `Projects`), only when
something changed, and checks that the share is really mounted first. The store's container
cannot see the share. Because the NUC can write to that share, the desktop's own crontab copies
every new archive (checked against its checksum) into `/media/pinkfloyd/Terra/Andrew/tubecad-backup-vault/`,
outside every share, and never deletes there. How to restore, also onto a new NUC:
`README-RESTORE.md` in the backup folder. One project alone can go back through the manager's
Import project… (its folder from an archive).

## Updating the NUC

```sh
curl -fsSL https://raw.githubusercontent.com/kothf/tube-amp-cad/main/server/share/update.sh | bash
```

It fetches the files from `main` into `~/tubecad-share`, makes `revisions/` (owned by uid 1000),
adds the `/api/rev/` block to `~/aerocat/nginx.conf` once (with a backup), rebuilds the container,
reloads nginx and checks both ends.

Test: `node --test tests/share-server.test.mjs tests/rev-server.test.mjs`.
