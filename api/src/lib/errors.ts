export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, msg?: string) => new HttpError(400, code, msg);
export const unauthorized = () => new HttpError(401, "unauthorized", "Please sign in.");
export const forbidden = () => new HttpError(403, "forbidden", "You don't have access to this.");
export const notFound = () => new HttpError(404, "not_found", "Not found.");
export const conflict = (code: string, msg?: string) => new HttpError(409, code, msg);
