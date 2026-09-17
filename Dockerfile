# ==========================================================================
# Image de production Kiraa — build multi-etapes sur Node 20-slim.
#
# La sortie `standalone` de Next.js embarque uniquement les dependances
# reellement utilisees, ce qui reduit fortement la taille de l'image finale.
# ==========================================================================

# ─── Etape 1 : dependances ────────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app

# Dependances systeme necessaires a onnxruntime-node et aux modules natifs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

# ─── Etape 2 : build ──────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Etape 3 : execution ──────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Next.js standalone ecoute sur $HOSTNAME ; Docker y place l'ID du conteneur,
# ce qui rend le service injoignable via localhost. On force 0.0.0.0.
ENV HOSTNAME=0.0.0.0

# Utilisateur non privilegie.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Sortie standalone + assets statiques.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Donnees sources : necessaires au seed et a l'indexation RAG.
COPY --from=builder --chown=nextjs:nodejs /app/data ./data
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

# ─── OCR : tesseract.js ───────────────────────────────────────────────────
# Le tracage `standalone` de Next.js ne copie que les fichiers qu'il detecte
# statiquement. Les binaires WASM de tesseract.js-core sont charges a
# l'execution : ils sont donc ABSENTS de la sortie standalone, et l'OCR
# echoue par `ENOENT ... tesseract-core-simd.wasm`. On recopie le paquet
# complet depuis l'etape `deps`. Ne pas supprimer cette ligne.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/tesseract.js-core \
  ./node_modules/tesseract.js-core

# ─── Rasterisation PDF (cahier des charges §8) ────────────────────────────
# Meme probleme de tracage : pdf.js charge ses polices standard depuis le
# systeme de fichiers a l'execution, et @napi-rs/canvas s'appuie sur un binaire
# natif .node. Sans ces deux copies, la bascule PDF -> OCR echoue et tout PDF
# sans texte natif part en CLARIFICATION_REQUIRED.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pdfjs-dist \
  ./node_modules/pdfjs-dist
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@napi-rs \
  ./node_modules/@napi-rs
ENV PDFJS_STANDARD_FONTS=/app/node_modules/pdfjs-dist/standard_fonts/

# Cache des modeles d'embeddings, inscriptible par l'utilisateur applicatif.
# /app appartient a root : sans repertoire dedie inscriptible, tesseract.js ne
# peut pas ecrire les `.traineddata` qu'il telecharge (son cachePath par
# defaut est './').
RUN mkdir -p /app/.cache/tessdata && chown -R nextjs:nodejs /app/.cache
ENV TRANSFORMERS_CACHE=/app/.cache
ENV TESSDATA_CACHE_PATH=/app/.cache/tessdata

# Pre-chargement des donnees de langue OCR, pour que la premiere reconnaissance
# ne depende ni du reseau ni d'un delai de telechargement. Best-effort : si le
# CDN est injoignable au build, tesseract.js les telechargera a l'execution
# dans TESSDATA_CACHE_PATH, qui est inscriptible.
RUN node -e "\
const {createGunzip}=require('zlib');const fs=require('fs');const {pipeline}=require('stream/promises');\
const base='https://tessdata.projectnaptha.com/4.0.0';\
(async()=>{for(const l of ['eng','fra']){\
  const r=await fetch(\`\${base}/\${l}.traineddata.gz\`);\
  if(!r.ok) throw new Error(l+' HTTP '+r.status);\
  await pipeline(require('stream').Readable.fromWeb(r.body),createGunzip(),fs.createWriteStream(\`/app/.cache/tessdata/\${l}.traineddata\`));\
  console.log('tessdata '+l+' OK');\
}})().catch(e=>{console.warn('tessdata prefetch ignore : '+e.message);});\
" && chown -R nextjs:nodejs /app/.cache

USER nextjs
EXPOSE 3000

# Le healthcheck applicatif verifie l'app ET la connexion PostgreSQL.
HEALTHCHECK --interval=15s --timeout=10s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
