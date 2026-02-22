import { createContext, useContext } from 'react';

const LogoutContext = createContext<() => void>(() => {});

export const LogoutProvider = LogoutContext.Provider;
export const useLogout = () => useContext(LogoutContext);
