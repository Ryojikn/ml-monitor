# MLMonitor — Kubernetes Deployment Guide

## Architecture in Kubernetes

```
                        ┌─────────────────────────────────────────┐
                        │         Kubernetes Cluster               │
  Browser ──HTTPS──▶   │  ┌──────────────────────────────────┐   │
                        │  │            Ingress (nginx)         │   │
                        │  │  /      → frontend-svc:3000       │   │
                        │  │  /api   → backend-svc:8000        │   │
                        │  └──────────────────────────────────┘   │
                        │         │                    │           │
                        │  ┌──────▼──────┐   ┌────────▼────────┐  │
                        │  │  Frontend   │   │    Backend      │  │
                        │  │  Deployment │   │   Deployment    │  │
                        │  │  replicas:2 │   │   replicas:2    │  │
                        │  └─────────────┘   └────────┬────────┘  │
                        │                             │           │
                        │               ┌─────────────▼──────┐   │
                        │               │  PostgreSQL         │   │
                        │               │  (managed DB or     │   │
                        │               │   StatefulSet)      │   │
                        │               └────────────────────┘   │
                        │                                         │
                        │  ┌─────────────────────────────────┐   │
                        │  │  PersistentVolumeClaim: uploads  │   │
                        │  └─────────────────────────────────┘   │
                        └─────────────────────────────────────────┘
```

### Kubernetes Resources Summary

| Resource | Name | Purpose |
|----------|------|---------|
| Namespace | `mlmonitor` | Isolation from other workloads |
| ConfigMap | `mlmonitor-config` | Non-secret environment variables |
| Secret | `mlmonitor-secrets` | DATABASE_URL, SMTP credentials |
| PersistentVolumeClaim | `mlmonitor-uploads` | Uploaded dataset files |
| Deployment | `mlmonitor-backend` | FastAPI backend (2 replicas) |
| Deployment | `mlmonitor-frontend` | React SPA (2 replicas) |
| Service | `mlmonitor-backend-svc` | ClusterIP for backend |
| Service | `mlmonitor-frontend-svc` | ClusterIP for frontend |
| Ingress | `mlmonitor-ingress` | External HTTPS routing |
| HPA | `mlmonitor-backend-hpa` | Auto-scale backend on CPU |
| Job | `mlmonitor-migrate` | Alembic migration pre-deploy |

---

## Prerequisites

```bash
# Required tools
kubectl version --client   # ≥ 1.28
helm version               # ≥ 3.14 (for ingress-nginx install)

# Install ingress-nginx controller (if not already present)
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

---

## Step 1 — Namespace

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: mlmonitor
```

```bash
kubectl apply -f namespace.yaml
```

---

## Step 2 — ConfigMap

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mlmonitor-config
  namespace: mlmonitor
data:
  CORS_ORIGINS: "https://mlmonitor.example.com"
  FRONTEND_BASE_URL: "https://mlmonitor.example.com"
  UPLOAD_DIR: "/app/uploads"
  LOG_LEVEL: "info"
```

---

## Step 3 — Secret

Replace values with real credentials. Use `base64` encoding for the manifest or
apply via `kubectl create secret` (recommended to avoid secrets in files):

```bash
kubectl create secret generic mlmonitor-secrets \
  --namespace mlmonitor \
  --from-literal=DATABASE_URL="postgresql+asyncpg://mlmonitor:PASSWORD@postgres-host:5432/mlmonitor" \
  --from-literal=SMTP_HOST="smtp.example.com" \
  --from-literal=SMTP_USER="alerts@example.com" \
  --from-literal=SMTP_PASS="smtp-password"
```

Or as a manifest (for GitOps — use sealed-secrets or Vault):

```yaml
# secret.yaml (values must be base64-encoded)
apiVersion: v1
kind: Secret
metadata:
  name: mlmonitor-secrets
  namespace: mlmonitor
type: Opaque
stringData:
  DATABASE_URL: "postgresql+asyncpg://mlmonitor:PASSWORD@postgres-host:5432/mlmonitor"
  SMTP_HOST: "smtp.example.com"
  SMTP_USER: "alerts@example.com"
  SMTP_PASS: "smtp-password"
```

---

## Step 4 — PersistentVolumeClaim (Uploads)

```yaml
# pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mlmonitor-uploads
  namespace: mlmonitor
spec:
  accessModes:
    - ReadWriteOnce     # Use ReadWriteMany (NFS/EFS) if running multiple backend replicas
  resources:
    requests:
      storage: 20Gi
  storageClassName: standard   # Replace with your cluster's storage class
```

> **Note:** `ReadWriteOnce` allows only one pod to write at a time. For multiple replicas with shared uploads, use a `ReadWriteMany`-capable storage class (e.g., AWS EFS, GCP Filestore, NFS).

---

## Step 5 — Alembic Migration Job

Run this before deploying or updating the backend to apply pending schema migrations:

```yaml
# migrate-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: mlmonitor-migrate
  namespace: mlmonitor
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrate
          image: your-registry/mlmonitor-backend:latest
          command: ["alembic", "upgrade", "head"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: mlmonitor-secrets
                  key: DATABASE_URL
```

```bash
kubectl apply -f migrate-job.yaml
kubectl wait --for=condition=complete job/mlmonitor-migrate -n mlmonitor --timeout=120s
```

---

## Step 6 — Backend Deployment

```yaml
# backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mlmonitor-backend
  namespace: mlmonitor
  labels:
    app: mlmonitor-backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: mlmonitor-backend
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0      # zero-downtime: new pods ready before old are removed
      maxSurge: 1
  template:
    metadata:
      labels:
        app: mlmonitor-backend
    spec:
      containers:
        - name: backend
          image: your-registry/mlmonitor-backend:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 8000
          envFrom:
            - configMapRef:
                name: mlmonitor-config
            - secretRef:
                name: mlmonitor-secrets
          volumeMounts:
            - name: uploads
              mountPath: /app/uploads
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "2Gi"
          readinessProbe:
            httpGet:
              path: /api/v1/health
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /api/v1/health
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 30
            failureThreshold: 3
      volumes:
        - name: uploads
          persistentVolumeClaim:
            claimName: mlmonitor-uploads
```

---

## Step 7 — Backend Service

```yaml
# backend-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: mlmonitor-backend-svc
  namespace: mlmonitor
spec:
  selector:
    app: mlmonitor-backend
  ports:
    - port: 8000
      targetPort: 8000
      protocol: TCP
  type: ClusterIP
```

---

## Step 8 — Frontend Deployment & Service

```yaml
# frontend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mlmonitor-frontend
  namespace: mlmonitor
  labels:
    app: mlmonitor-frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: mlmonitor-frontend
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app: mlmonitor-frontend
    spec:
      containers:
        - name: frontend
          image: your-registry/mlmonitor-frontend:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 3000
          env:
            - name: VITE_API_BASE_URL
              value: ""   # Empty = relative path, proxied by nginx/ingress
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: mlmonitor-frontend-svc
  namespace: mlmonitor
spec:
  selector:
    app: mlmonitor-frontend
  ports:
    - port: 3000
      targetPort: 3000
  type: ClusterIP
```

---

## Step 9 — Ingress

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mlmonitor-ingress
  namespace: mlmonitor
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"   # allow large dataset uploads
    cert-manager.io/cluster-issuer: "letsencrypt-prod"    # remove if not using cert-manager
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - mlmonitor.example.com
      secretName: mlmonitor-tls
  rules:
    - host: mlmonitor.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: mlmonitor-backend-svc
                port:
                  number: 8000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: mlmonitor-frontend-svc
                port:
                  number: 3000
```

---

## Step 10 — HorizontalPodAutoscaler

```yaml
# hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mlmonitor-backend-hpa
  namespace: mlmonitor
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mlmonitor-backend
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

---

## Deploy Everything

```bash
# Apply in order
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml       # or use kubectl create secret
kubectl apply -f pvc.yaml
kubectl apply -f migrate-job.yaml
kubectl wait --for=condition=complete job/mlmonitor-migrate -n mlmonitor --timeout=120s
kubectl apply -f backend-deployment.yaml
kubectl apply -f backend-service.yaml
kubectl apply -f frontend-deployment.yaml    # frontend-service is inline
kubectl apply -f ingress.yaml
kubectl apply -f hpa.yaml

# Verify
kubectl get pods -n mlmonitor
kubectl get ingress -n mlmonitor
```

---

## PostgreSQL Recommendations

For production, use a **managed database** rather than a Kubernetes StatefulSet:

| Cloud | Service | Notes |
|-------|---------|-------|
| AWS | RDS PostgreSQL 15 | Enable Multi-AZ; use `db.t4g.medium` minimum |
| GCP | Cloud SQL PostgreSQL 15 | Enable High Availability; use private IP |
| Azure | Azure Database for PostgreSQL | Flexible Server recommended |
| Self-hosted | Postgres Operator (Zalando) | Use for on-prem Kubernetes clusters |

**Connection string format:**
```
postgresql+asyncpg://USER:PASSWORD@HOST:5432/mlmonitor?ssl=require
```

**Minimum database specs:**
- vCPUs: 2
- RAM: 4 GB
- Storage: 50 GB SSD (auto-grow enabled)

---

## Production Checklist

- [ ] PostgreSQL managed database provisioned (not SQLite)
- [ ] `asyncpg` installed in backend image (`pip install asyncpg`)
- [ ] `DATABASE_URL` secret set with production credentials
- [ ] TLS certificate provisioned (cert-manager or manual)
- [ ] `CORS_ORIGINS` set to production frontend domain only
- [ ] `FRONTEND_BASE_URL` set to production URL (used in alert notification links)
- [ ] Ingress `proxy-body-size` set high enough for large dataset uploads
- [ ] PVC uses `ReadWriteMany` storage class if running > 1 backend replica
- [ ] Migration job runs successfully before backend pods start
- [ ] Readiness probe passing before traffic is routed
- [ ] HPA configured with appropriate min/max replica counts
- [ ] Resource limits set on all containers
- [ ] Secrets managed via Vault, Sealed Secrets, or cloud KMS (not plain YAML in git)
- [ ] Log aggregation configured (Datadog, CloudWatch, Loki, etc.)
- [ ] Monitoring dashboard set up for HTTP error rates, pod restarts, run latency
