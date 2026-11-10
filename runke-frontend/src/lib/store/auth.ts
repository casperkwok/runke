import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  setTokens: (access: string, refresh: string) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      setTokens: (access, refresh) => set({ token: access, refreshToken: refresh }),
      clear: () => set({ token: null, refreshToken: null }),
    }),
    { name: "runke-auth" },
  ),
);
