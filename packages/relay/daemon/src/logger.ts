import pino from "pino";

interface Store {
  logger?: pino.Logger
}

let store: Store = {};

export const logger = () => {
  if (!store.logger) {
    const transport = pino.transport({
      targets: [
        {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        },
      ],
    });

    store.logger = pino(transport);
  }

  return store.logger;
}
