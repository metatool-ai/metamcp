# Kubernetes Deployment

This directory contains a small, plain Kubernetes deployment for MetaMCP with:

- a PostgreSQL `Deployment` and `PersistentVolumeClaim`
- a MetaMCP `Deployment`
- internal `ClusterIP` services
- an optional HTTP ingress

The manifests are intentionally standard YAML so they can be applied directly,
rendered with `envsubst`, or wrapped by Kustomize/Helm in downstream
environments.

## Prerequisites

- Kubernetes 1.25+
- A default `StorageClass`, or set `METAMCP_STORAGE_CLASS`
- An ingress controller if you enable `ingress.yaml`
- `kubectl`
- `envsubst` from GNU gettext if you use the example rendering flow

## Configure

Copy the example environment file and edit the values:

```bash
cp deploy/kubernetes/example.env deploy/kubernetes/.env
$EDITOR deploy/kubernetes/.env
```

Generate production secrets before deploying:

```bash
openssl rand -base64 32
```

At minimum, set:

- `METAMCP_NAMESPACE`
- `METAMCP_PUBLIC_URL`
- `METAMCP_HOST`
- `METAMCP_POSTGRES_PASSWORD`
- `METAMCP_BETTER_AUTH_SECRET`
- `METAMCP_BOOTSTRAP_USER_EMAIL`
- `METAMCP_BOOTSTRAP_USER_PASSWORD`

For production, use HTTPS for `METAMCP_PUBLIC_URL` so MetaMCP auth and CORS
match the public URL used by browsers and MCP clients.

## Deploy

Render and apply the manifests:

```bash
set -a
. deploy/kubernetes/.env
set +a

mkdir -p /tmp/metamcp-k8s
for file in deploy/kubernetes/*.yaml; do
  envsubst < "$file" > "/tmp/metamcp-k8s/$(basename "$file")"
done

kubectl apply -f /tmp/metamcp-k8s/namespace.yaml
kubectl apply -f /tmp/metamcp-k8s/secret.yaml
kubectl apply -f /tmp/metamcp-k8s/postgres.yaml
kubectl apply -f /tmp/metamcp-k8s/metamcp.yaml
kubectl apply -f /tmp/metamcp-k8s/ingress.yaml
```

If you do not use ingress, skip `ingress.yaml` and use port-forwarding:

```bash
kubectl -n "$METAMCP_NAMESPACE" port-forward svc/metamcp 12008:80
```

Then open the value of `METAMCP_PUBLIC_URL`, or
`http://127.0.0.1:12008` when port-forwarding and local URLs are configured.

## Validate

Check rollout status:

```bash
kubectl -n "$METAMCP_NAMESPACE" rollout status deploy/metamcp-postgres
kubectl -n "$METAMCP_NAMESPACE" rollout status deploy/metamcp
```

Check the application logs:

```bash
kubectl -n "$METAMCP_NAMESPACE" logs deploy/metamcp
```

Check the public endpoint:

```bash
curl -i "$METAMCP_PUBLIC_URL"
```

## Notes

- The MetaMCP deployment uses `strategy.type: Recreate` and `replicas: 1` by
  default. MetaMCP runs database migrations at startup and manages MCP sessions,
  so avoid horizontal scaling unless you have made the session and migration
  behavior safe for your environment.
- The included PostgreSQL deployment is suitable for small self-hosted
  deployments. For production environments that already have managed Postgres,
  replace `postgres.yaml` and set `DATABASE_URL`/Postgres env vars accordingly.
- Do not commit rendered secrets or `.env` files.
