FROM node:22-slim

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm install --unsafe-perm
RUN npx prisma@7.9.1 generate

COPY . .

EXPOSE 10000

CMD ["node", "src/worker.js"]
