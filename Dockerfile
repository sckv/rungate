FROM node:slim as builder

WORKDIR /usr/src/app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . ./
RUN npx lerna bootstrap && yarn build

FROM node:slim as broker

WORKDIR /usr/src/app

COPY packages/broker/package.json packages/broker/yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY --from=builder /usr/src/app/packages/broker/lib ./lib

CMD [ "yarn", "start" ]

FROM node:slim as core

WORKDIR /usr/src/app

COPY packages/core/package.json packages/core/yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY --from=builder /usr/src/app/packages/core/lib ./lib

CMD [ "yarn", "start" ]

FROM node:slim as service

WORKDIR /usr/src/app

COPY packages/service/package.json packages/service/yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY --from=builder /usr/src/app/packages/service/lib ./lib

CMD [ "yarn", "start" ]

FROM node:slim as ui

WORKDIR /usr/src/app

COPY packages/ui/package.json packages/ui/yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY --from=builder /usr/src/app/packages/ui/.next ./.next

CMD [ "yarn", "start" ]
