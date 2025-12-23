FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY env.sample ./env.sample

ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/app.js"]

