from fastapi import FastAPI

app = FastAPI(
    title="Next-Gen Chess Analyzer API",
    version="1.0.0",
    description="API backend for chess analyzer application."
)

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/ready")
async def readiness_check():
    return {"status": "ready"}
