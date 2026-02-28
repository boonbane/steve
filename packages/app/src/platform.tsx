import { createContext, useContext, type ParentProps } from "solid-js";

export type Platform = {
  platform: "web" | "desktop";
  openLink: (url: string) => void;
  back: () => void;
  forward: () => void;
  restart: () => void | Promise<void>;
};

export const webPlatform: Platform = {
  platform: "web",
  openLink: (url) => {
    window.open(url, "_blank");
  },
  back: () => {
    window.history.back();
  },
  forward: () => {
    window.history.forward();
  },
  restart: () => {
    window.location.reload();
  },
};

const PlatformContext = createContext<Platform>(webPlatform);

export const PlatformProvider = (props: ParentProps<{ value?: Platform }>) => {
  return (
    <PlatformContext.Provider value={props.value ?? webPlatform}>
      {props.children}
    </PlatformContext.Provider>
  );
};

export const usePlatform = () => {
  return useContext(PlatformContext);
};
