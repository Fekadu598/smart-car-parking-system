import { auth } from "../firebase";

export default async function callApi(functionName, data = {}) {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;

  const response = await fetch(`/api/callable?name=${encodeURIComponent(functionName)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });

  const json = await response.json();

  if (json.error) {
    const error = new Error(json.error.message);
    error.code = json.error.status;
    error.details = json.error.details;
    throw error;
  }

  return json;
}
