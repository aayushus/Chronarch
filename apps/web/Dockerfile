FROM node:26-slim AS build
WORKDIR /srv
COPY apps/web/package.json ./
RUN npm install
COPY apps/web ./
RUN npm run build

FROM nginx:1.31-alpine
COPY --from=build /srv/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# Drop the stock ipv6 entrypoint probe: it shells out to the network
# (apk manifest) and hangs this sandbox's stack at boot. Our listener is
# plain IPv4 :80 and the /api/ resolver already pins ipv6=off.
RUN rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh
EXPOSE 80
