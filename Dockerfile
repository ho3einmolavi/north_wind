FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "node db/wait-for-db.js && npx ts-node db/seed.ts && npm run start:dev"]
