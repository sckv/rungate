# WIP: RunGate

A scalable graphql gateway for cloud.
Refreshes remote schemas seamlessly without users disturbance.

# Structure

## `@rungate/core`

Gateway as to recompute and listen to the redis changes of the published schema.

Should have a unique `name` between all the possible gateways (if more than 1 are planned)

## `@rungate/broker`

The broker of the schemas where all the magic happens. This broker is responsible for merging and checking different services schema into one, triaging it if needed and publishing if it is safe, to the store, which is redis.

## `@rungate/service`

A service post-start hook that will try to announce it's schema readiness to the broker. This hook will also listen for the termination of the process to deregister the service schema from the broker.

# Usage

TBW

# Support

Please open an issue if you have any questions or need support

# License

Licensed under [MIT](https://github.com/sckv/rungate/blob/master/LICENSE).

Konstantin Knyazev
