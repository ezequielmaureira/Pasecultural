import { PrismaClient } from "@prisma/client";
import { instrumentPrismaClient } from "../utils/whatsappPerf.js";

// Fase 3N — instrumentación diagnóstica opcional (WHATSAPP_PERF_LOG=true,
// ver utils/whatsappPerf.js): `$extends` devuelve un cliente con la MISMA
// API pública (drop-in compatible, es el mecanismo oficial de Prisma para
// esto) — cuando la instrumentación está desactivada, cada query pasa por
// una única comparación extra antes de ejecutarse tal cual, sin tocar
// AsyncLocalStorage ni medir nada. Sigue siendo el único
// `new PrismaClient()` de todo el backend.
const prisma = instrumentPrismaClient(new PrismaClient());

export default prisma;
