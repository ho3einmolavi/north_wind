# Network setup

If `npm install` or Docker image pulls are slow or blocked on your network,
point them at a mirror:

- **npm:** set `registry=<your-mirror>` in `.npmrc`
- **Docker:** configure a registry mirror in your Docker daemon settings

Both `make up` (online) and `make load` (offline / build-from-source) are supported.
