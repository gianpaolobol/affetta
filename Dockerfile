FROM node:20-bookworm-slim
WORKDIR /app
COPY . /app
RUN mkdir -p /app/data/artifacts /app/data/uploads && chown -R node:node /app
USER node
ENV AFFETTA_HOST=0.0.0.0 AFFETTA_PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","bootstrap.js"]
