FROM node:20-slim AS build
WORKDIR /srv
COPY apps/web/package.json ./
RUN npm install
COPY apps/web ./
RUN npm run build

FROM nginx:1.31-alpine
COPY --from=build /srv/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
