FROM node:22-slim

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm install
RUN npx prisma generate

COPY . .

EXPOSE 10000

CMD ["node", "src/worker.js"]