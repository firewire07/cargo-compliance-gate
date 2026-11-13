export interface SessionUser {
  id: string;
  username: string;
  roles: string[];
}

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: SessionUser;
}
