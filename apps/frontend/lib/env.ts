// No longer required - using relative URLs for flexible deployment
export const getAppUrl = () => {
  return typeof window !== "undefined" ? window.location.origin : "";
};
