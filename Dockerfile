FROM node:14

WORKDIR /usr/src/app
RUN apt-get update && apt-get install build-essential -y

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8080
EXPOSE 8081

RUN sh ./gen_ca.sh

CMD npm run start
