#!/usr/bin/env bash
# ==============================================================================
# IBVAP — Intelligent Border Video Analytics Platform
# Master Control Script for macOS / Linux
# Usage:
#   ./run.sh          (or ./run.sh demo) - Start full stack demo
#   ./run.sh webcam   - Start stack using local laptop webcam
#   ./run.sh stop     - Stop all running IBVAP processes
#   ./run.sh status   - Check status of all stack services
#   ./run.sh test     - Run test suite
#   ./run.sh clean    - Reset runtime database & evidence
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_BIN="python3"
if [ -x "venv/bin/python3" ]; then
    PYTHON_BIN="venv/bin/python3"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
fi

show_banner() {
    echo ""
    echo "================================================================"
    echo "      IBVAP - INTELLIGENT BORDER VIDEO ANALYTICS PLATFORM       "
    echo "                    [ macOS / Unix Runner ]                     "
    echo "================================================================"
    echo ""
}

stop_services() {
    echo "Stopping all IBVAP services..."
    pkill -f "apps.backend.main:app" 2>/dev/null || true
    pkill -f "services/inference/main_inference_worker.py" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    # Also release ports 8000 and 5173 if still bound
    for port in 8000 5173; do
        PID=$(lsof -ti :$port 2>/dev/null || true)
        if [ -n "$PID" ]; then
            kill -9 $PID 2>/dev/null || true
        fi
    done
    echo "[OK] All background services stopped cleanly."
}

check_status() {
    echo "Inspecting IBVAP services..."
    BACKEND_PID=$(lsof -ti :8000 2>/dev/null | head -n 1 || true)
    WORKER_PID=$(pgrep -f "main_inference_worker.py" | head -n 1 || true)
    FRONT_PID=$(lsof -ti :5173 2>/dev/null | head -n 1 || true)

    if [ -n "$BACKEND_PID" ]; then
        echo "Backend (FastAPI):  RUNNING (PID $BACKEND_PID) -> http://localhost:8000"
    else
        echo "Backend (FastAPI):  STOPPED"
    fi

    if [ -n "$WORKER_PID" ]; then
        echo "Inference Worker:   RUNNING (PID $WORKER_PID)"
    else
        echo "Inference Worker:   STOPPED"
    fi

    if [ -n "$FRONT_PID" ]; then
        echo "Frontend (React):   RUNNING (PID $FRONT_PID) -> http://localhost:5173"
    else
        echo "Frontend (React):   STOPPED"
    fi
}

start_stack() {
    MODE="${1:-demo}"
    show_banner
    mkdir -p data/logs data/evidence

    # Stop any conflicting previous instances
    echo "[1/4] Ensuring clean port & process state..."
    stop_services >/dev/null 2>&1 || true
    sleep 1

    # 1. Start FastAPI Backend
    echo "[2/4] Starting FastAPI Backend on port 8000..."
    nohup $PYTHON_BIN -m uvicorn apps.backend.main:app --host 0.0.0.0 --port 8000 > data/logs/backend.log 2>&1 &
    BACKEND_PID=$!
    disown $BACKEND_PID 2>/dev/null || true
    
    # Wait for Backend to be healthy
    echo -n "      Waiting for Backend (/health)..."
    for i in {1..20}; do
        if curl -s http://127.0.0.1:8000/health | grep -q "ok"; then
            echo " [READY]"
            break
        fi
        sleep 0.5
    done

    # 2. Start AI Inference Worker
    if [ "$MODE" = "webcam" ]; then
        echo "[3/4] Starting AI Inference Worker for WEBCAM-01 (Laptop Camera)..."
        nohup $PYTHON_BIN services/inference/main_inference_worker.py --camera WEBCAM-01 --rtsp webcam:0 > data/logs/worker_webcam.log 2>&1 &
        WORKER_PID=$!
        disown $WORKER_PID 2>/dev/null || true
    else
        echo "[3/4] Starting AI Inference Worker for CAM-01 (CCTV Simulation Loop)..."
        nohup $PYTHON_BIN services/inference/main_inference_worker.py --camera CAM-01 --rtsp data/raw/test_video.mp4 > data/logs/worker_cctv.log 2>&1 &
        WORKER_PID=$!
        disown $WORKER_PID 2>/dev/null || true
    fi
    sleep 2

    # 3. Start Frontend Dev Server
    echo "[4/4] Starting React / Vite Dashboard on port 5173..."
    (cd apps/frontend && nohup ./node_modules/.bin/vite --host 0.0.0.0 --port 5173 > ../../data/logs/frontend.log 2>&1 &)
    
    # Wait for Frontend to respond
    echo -n "      Waiting for Dashboard (localhost:5173)..."
    for i in {1..20}; do
        if curl -s http://localhost:5173 >/dev/null 2>&1; then
            echo " [READY]"
            break
        fi
        sleep 0.5
    done

    echo ""
    echo "================================================================"
    echo "       IBVAP SYSTEM IS ONLINE & OPERATIONAL!                    "
    echo "================================================================"
    echo "  * Dashboard UI:      http://localhost:5173"
    echo "  * Backend API:       http://localhost:8000"
    echo "  * Swagger Docs:      http://localhost:8000/docs"
    echo "  * Live Video Stream: http://localhost:8000/api/v1/cameras/CAM-01/stream"
    echo "================================================================"
    echo " Logs available in data/logs/ directory."
    echo " To stop the system anytime, run: ./run.sh stop"
    echo ""

    # Open browser on macOS
    if command -v open >/dev/null 2>&1; then
        open "http://localhost:5173" 2>/dev/null || true
    fi
}

ACTION="${1:-demo}"

case "$ACTION" in
    demo|start)
        start_stack "demo"
        ;;
    webcam)
        start_stack "webcam"
        ;;
    stop)
        stop_services
        ;;
    status)
        check_status
        ;;
    test)
        pytest tests/ -v
        ;;
    clean)
        echo "Clearing runtime operational data..."
        $PYTHON_BIN scripts/clean_reset.py 2>/dev/null || rm -rf data/evidence/* ibvap.db data/ibvap_dev.db
        echo "[OK] Clean reset complete."
        ;;
    restart)
        stop_services
        sleep 1
        start_stack "demo"
        ;;
    *)
        echo "Usage: $0 {demo|start|webcam|stop|status|test|clean|restart}"
        exit 1
        ;;
esac
