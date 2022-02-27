FROM node:latest

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8080
EXPOSE 8081

RUN sh ./gen_ca.sh

CMD npm run start
