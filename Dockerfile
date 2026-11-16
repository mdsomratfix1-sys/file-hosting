FROM node:20-bookworm-slim
WORKDIR /app
# better-sqlite3 কখনও কখনও সোর্স থেকে বিল্ড হয়, তাই build tools রাখা হলো
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/app/data PORT=3000
EXPOSE 3000
CMD ["node", "index.js"]
