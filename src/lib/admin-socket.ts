import type { Server } from 'socket.io';
import type { SocketUser } from './socket-auth';

/** Removes wallets from the admins socket room after expiry or revocation (#276). */
export function evictAdminsFromRoom(io: Server, walletAddresses: string[]): void {
  const targets = new Set(walletAddresses);
  for (const socket of io.sockets.sockets.values()) {
    const user = socket.data.user as SocketUser | undefined;
    if (!user || !targets.has(user.walletAddress)) continue;
    void socket.leave('admins');
    socket.emit('ADMIN_ACCESS_REVOKED', { reason: 'ASSIGNMENT_ENDED' });
  }
}