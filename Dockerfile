# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Install deps first so Docker can cache this layer.
COPY package.json ./
RUN npm install --omit=dev

# Then the source.
COPY index.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
