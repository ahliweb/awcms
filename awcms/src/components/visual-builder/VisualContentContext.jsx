import { createContext, useContext } from 'react';

const VisualContentContext = createContext({
  page: null,
  blog: null,
});

export function VisualContentProvider({ value, children }) {
  return (
    <VisualContentContext.Provider value={value || { page: null, blog: null }}>
      {children}
    </VisualContentContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVisualContentContext() {
  return useContext(VisualContentContext);
}
