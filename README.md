# IBVAP — Intelligent Border Video Analytics Platform

> **SIH Problem Statement PS-26187** | MHA — Ministry of Home Affairs
> AI-powered analytics layer for existing IP-CCTV border surveillance infrastructure.

---

## What is IBVAP?

IBVAP adds intelligence to **existing** CCTV cameras without replacing hardware.

```
Existing CCTV → RTSP → Video Ingestion → AI Detection → Tracking
  → Spatial Rules → Event Correlation → Alert → Evidence → Dashboard
  → Operator Feedback → Dataset → Retraining → Canary → Production
```

Core philosophy: **Camera replace nahi karni. Existing CCTV ko intelligent banana hai.**

---

## Key Capabilities

| Capability | Status |
|---|---|
| Multi-camera RTSP ingestion | ✅ |
| Human & vehicle detection | ✅ |
| Multi-object tracking | ✅ |
| Virtual fence / zone rules | ✅ |
| ANPR (license plate OCR) | ✅ |
| Night / low-light processing | ✅ (CLAHE) |
| Suspicious activity detection | ✅ |
| Real-time alert dashboard | ✅ |
| Evidence with SHA-256 integrity | ✅ |
| Operator feedback loop | ✅ |
| Human-supervised model retraining | ✅ |
| Offline-first (no cloud dependency) | ✅ |
| Audit logging | ✅ |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        IBVAP System                             │
├─────────────────────────────────────────────────────────────────┤
│  CCTV / MediaMTX RTSP Simulator                                 │
│  CAM-01 (day) │ CAM-02 (night) │ CAM-03 (zone) │ CAM-04 (ANPR) │
├─────────────────────────────────────────────────────────────────┤
│  services/ingestion     → Bounded frame buffer, reconnect       │
│  services/preprocessing → Quality assessment, CLAHE             │
│  services/detection     → YOLOv8n (CPU) / GPU adapter          │
│  services/tracking      → ByteTrack multi-object tracker        │
│  services/rules         → Virtual fence, spatial rule engine    │
│  services/anpr          → Vehicle → Plate → EasyOCR             │
│  services/incidents     → Event correlation, evidence store     │
│  services/feedback      → Operator labeling loop                │
├─────────────────────────────────────────────────────────────────┤
│  apps/backend           → FastAPI + WebSocket + RBAC            │
│  apps/frontend          → React + TypeScript operations UI      │
├─────────────────────────────────────────────────────────────────┤
│  ml/                    → DVC datasets, MLflow, model registry  │
│  infrastructure/        → MediaMTX, Docker, optional NVIDIA     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
IBVAP/
├── apps/
│   ├── backend/          # FastAPI backend
│   └── frontend/         # React + TypeScript dashboard
├── services/
│   ├── ingestion/        # RTSP camera source + frame buffer
│   ├── preprocessing/    # Video quality + CLAHE
│   ├── detection/        # DetectionEngine interface + adapters
│   ├── tracking/         # Multi-object tracker
│   ├── rules/            # Spatial + temporal rule engine
│   ├── anpr/             # Vehicle → Plate → OCR pipeline
│   ├── incidents/        # Event correlation + evidence
│   └── feedback/         # Operator feedback service
├── ml/
│   ├── datasets/         # Dataset registry (no raw data in Git)
│   ├── labeling/         # CVAT/Label Studio export tools
│   ├── training/         # Retrain pipeline + active learning
│   ├── evaluation/       # MLflow tracking
│   └── models/           # Model registry (metadata only)
├── infrastructure/
│   ├── mediamtx/         # Local RTSP camera simulator
│   ├── docker/           # Docker Compose configs
│   └── nvidia/           # Optional TensorRT adapter
├── configs/              # Camera, zone, system configs
├── data/                 # LOCAL ONLY — never committed to Git
│   ├── raw/              # Source video clips
│   ├── processed/        # Preprocessed frames
│   ├── labeled/          # Annotated datasets
│   ├── validation/       # Fixed validation set (never modified)
│   └── incidents/        # Evidence files
├── tests/                # Unit + integration tests
├── docs/                 # All documentation
└── scripts/              # Dev utilities
```

---

## 🚀 Quick Start (Team Execution)

See **[SETUP.md](SETUP.md)** for the complete guide.

```powershell
# 1. Install dependencies
pip install -r requirements/dev.txt
pip install -r requirements/ml.txt
cd apps/frontend && npm install && cd ../..

# 2. Run automated demo with pre-recorded RTSP CCTV loop
.\scripts\ibvap.ps1 demo

# 3. Or run using your local laptop webcam
.\scripts\ibvap.ps1 webcam

# 4. Open UI in browser
http://localhost:5173

# 5. Run automated test suite (75/75 passing)
pytest tests/ -q
```

---

## 👥 Team Work Allocation & Status

For detailed role assignments and authoritative system disclosures:
- **[STATUS.md](STATUS.md)** — Empirical status matrix & anti-fabrication disclosure
- **[TEAM_TASKS.md](TEAM_TASKS.md)** — 5-member work allocation & roadmap
- **[SETUP.md](SETUP.md)** — Step-by-step teammate setup instructions
- **[TEST_REPORT.md](TEST_REPORT.md)** — Automated test verification results

---

## Important Disclaimers

> **⚠️ SIH Prototype Notice**
> This is a research and demonstration prototype built for Smart India Hackathon.
> It is **not** a certified operational deployment.
> Actual border deployment requires: security assessment, hardware validation, model validation,
> privacy/data governance, license clearance, network/security review, and operational acceptance testing.

> **🔒 No Cloud Dependency**
> Core inference, database, dashboard, and evidence storage operate fully offline.
> No data leaves the edge device during normal operation.

> **📜 License**
> See [LICENSE](LICENSE) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

---

## Documentation

| Document | Description |
|---|---|
| [SETUP.md](SETUP.md) | Teammate setup & quick start guide |
| [STATUS.md](STATUS.md) | Honest status matrix & disclosures |
| [TEAM_TASKS.md](TEAM_TASKS.md) | 5-member roadmap & responsibilities |
| [TEST_REPORT.md](TEST_REPORT.md) | Empirical 75/75 test pass report |
| [docs/architecture.md](docs/architecture.md) | Full system architecture |
| [docs/DATASET_GUIDE.md](docs/DATASET_GUIDE.md) | Data sourcing & licensing |
| [docs/rtsp-development.md](docs/rtsp-development.md) | RTSP simulator setup |
| [SECURITY.md](SECURITY.md) | Security policy & threat model |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | All dependency licenses |

---

*Built for SIH 2026 | PS-26187 | Ministry of Home Affairs*
