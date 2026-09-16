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

# Cache des modeles d'embeddings, inscriptible par l'utilisateur applicatif.
RUN mkdir -p /app/.cache && chown -R nextjs:nodejs /app/.cache
ENV TRANSFORMERS_CACHE=/app/.cache

USER nextjs
EXPOSE 3000

# Le healthcheck applicatif verifie l'app ET la connexion PostgreSQL.
HEALTHCHECK --interval=15s --timeout=10s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
