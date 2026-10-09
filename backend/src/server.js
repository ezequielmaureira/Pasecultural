import "dotenv/config";
import app from "./app.js";
import { startBackgroundJobs } from "./jobs/backgroundJobs.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    // Reconciliación de pagos + reintento de emails — sólo si
    // BACKGROUND_JOBS_ENABLED=true (ver src/jobs/backgroundJobs.js).
    startBackgroundJobs();
});
