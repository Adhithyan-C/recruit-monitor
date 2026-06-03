export const tokenStorage = {
  get() {
    return localStorage.getItem('auth_token');
  },

  set(token) {
    localStorage.setItem('auth_token', token);
  },

  clear() {
    localStorage.removeItem('auth_token');
  },
};
