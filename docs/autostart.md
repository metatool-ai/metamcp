# Auto-Start and Resiliency

The Compose stack already publishes the MetaMCP API on `12008` via `12008:12008` in `docker-compose.yml`, so the host port remains stable across restarts. Keep `APP_URL` (and `NEXT_PUBLIC_APP_URL`) aligned with that port in your `.env` file if you ever change it.

## Enable automatic restarts
The `app` service now uses `restart: unless-stopped`, which keeps the container running if it crashes or Docker is restarted. You can confirm the policy at any time with:

```sh
docker compose ps --format '{{.Name}} {{.Ports}} {{.Status}}'
```

## Launch on login with launchd (macOS)
The repository ships with a helper script at `scripts/metamcp-launch.sh` that runs `docker compose up` from the project root. The script exports an explicit `PATH` (including Docker Desktop’s credential helper) and `COMPOSE_PROJECT_NAME` so LaunchAgents can resolve everything correctly.

1. Ensure Docker Desktop is configured to start at login.
2. Install the user LaunchAgent we provisioned at `~/Library/LaunchAgents/com.metatool.metamcp.plist`:

   ```sh
   launchctl load -w ~/Library/LaunchAgents/com.metatool.metamcp.plist
   ```

3. Verify the job is running and healthy:

   ```sh
   launchctl list | grep com.metatool.metamcp
   docker compose ps
   ```

Launchd keeps the job alive (thanks to `KeepAlive`), so if Docker restarts or the compose process exits unexpectedly, it comes back on its own while keeping the `12008` port binding.

## Launch on system boot with systemd (Linux)
1. Choose where the repository lives on the host (e.g., `/opt/metamcp`).
2. Create `/etc/systemd/system/metamcp.service` with the following contents (update the `WorkingDirectory` and the path to `docker` if needed):

   ```ini
   [Unit]
   Description=MetaMCP Docker Compose stack
   Requires=docker.service
   After=docker.service

   [Service]
   Type=oneshot
   RemainAfterExit=yes
   WorkingDirectory=/opt/metamcp
   Environment="COMPOSE_PROJECT_NAME=metamcp"
   ExecStart=/usr/bin/docker compose up --detach
   ExecStop=/usr/bin/docker compose down
   TimeoutStartSec=0

   [Install]
   WantedBy=multi-user.target
   ```

3. Reload systemd and enable the service:

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now metamcp.service
   ```

4. Check status and logs as needed:

   ```sh
   systemctl status metamcp.service
   sudo journalctl -u metamcp.service -f
   ```

With either LaunchAgents or systemd enabled, the stack comes up automatically and stays running unless you explicitly stop it. `docker compose` keeps the port binding at `12008`, so clients can rely on the same endpoint across restarts.
