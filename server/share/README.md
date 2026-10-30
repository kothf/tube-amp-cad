# Short-link store

`File ▾ → Share link…` in the CAD packs the design into text (see `cad-share.js`). On
aerocat.tech the app also sends that text here and gets a 10-character id back, so the link is
`https://aerocat.tech/s/<id>`. Elsewhere, or when this store can't be reached, the app gives the
long self-contained link instead.

- `server.mjs`: the store (Node only, no packages). Keeps each design once, named by its SHA-256,
  and only text that unpacks to a Tube Amp CAD design. Limits: 96k characters a design, 512 MB in
  all (`MAX_TEXT`, `MAX_TOTAL`); POSTs only from `ORIGINS`.
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

Test: `node --test tests/share-server.test.mjs`.
