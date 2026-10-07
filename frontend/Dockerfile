FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install

COPY . .

EXPOSE 5173

# CMD overridden by docker-compose for dev
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
