# sbs-client-webui

Independent OBS-like SBS browser client.

Goals:
- connect to `sbs-server` over the public WebSocket control API
- render WebRTC preview for operators on a PC browser
- mirror server state through `system.getState` plus PubSub events
- translate UI actions into canonical SBS commands

This project is intended to become its own git repository.

## Deploy

The WebUI is served independently from `sbs-server`. Set `TARGET` in an untracked `.env` file or the environment, then run:

```sh
bash scripts/deploy.sh
```

By default the script deploys the built static assets to `/var/www/sbs-webui`. Override this with `REMOTE_WEBUI_DIR` when the target web server uses a different document root.
