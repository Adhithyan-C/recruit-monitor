let memoryToken = null;

export const tokenStorage = {
  get() {
    if (memoryToken) return memoryToken;
    memoryToken = sessionStorage.getItem('token');
    return memoryToken;
  },

  set(token) {
    memoryToken = token;
    sessionStorage.setItem('token', token);
  },

  clear() {
    memoryToken = null;
    sessionStorage.removeItem('token');
  },
};
