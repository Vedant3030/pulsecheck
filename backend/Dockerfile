FROM node:22-slim

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm install --unsafe-perm
RUN npx prisma generate

COPY . .

EXPOSE 8000

CMD ["node", "src/main.js"]
