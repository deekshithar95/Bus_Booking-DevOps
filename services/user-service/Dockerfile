FROM node:22-alpine3.24
ENV NODE_ENV=production

RUN apk add --no-cache libcrypto3 libssl3
RUN npm install -g npm@latest

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
USER node
EXPOSE 3000
CMD ["npm", "start"]