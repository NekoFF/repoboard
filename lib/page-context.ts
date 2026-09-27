import {
  ensureRepositoryRow,
  getBoardData,
  getRepoHeader,
  type BoardData,
  type RepoHeader,
} from "@/lib/board-service";
import { currentWho, getVerifiedRepository } from "@/lib/github/access";
import { canSeeBoard, type Who } from "@/lib/roles";

const emptyData: BoardData = {
  repository: null,
  boardId: null,
  columns: [],
  board: null,
  tasks: [],
  milestones: [],
  markdownSource: null,
};
const emptyHeader: RepoHeader = {
  owner: null,
  name: null,
  defaultBranch: null,
  lastSyncAt: null,
};

export async function getPageContext(boardId?: string | null): Promise<{
  data: BoardData;
  header: RepoHeader;
  connected: boolean;
  /** Who is looking, and their role — for listing only the boards they may see. */
  who: Who | null;
}> {
  const verified = await getVerifiedRepository();
  if (!verified) return { data: emptyData, header: emptyHeader, connected: false, who: null };
  const who = await currentWho();
  try {
    await ensureRepositoryRow(verified);
    const data = getBoardData(boardId);
    if (!data.repository ||
      data.repository.owner.toLowerCase() !== verified.owner.toLowerCase() ||
      data.repository.name.toLowerCase() !== verified.name.toLowerCase()) {
      return { data: emptyData, header: emptyHeader, connected: false, who };
    }
    // A board kept to its owner is, for anyone else, not there.
    if (data.board && !canSeeBoard(who, { owner: data.board.owner, visibility: data.board.visibility })) {
      return { data: { ...emptyData, repository: data.repository }, header: getRepoHeader(), connected: true, who };
    }
    return { data, header: getRepoHeader(), connected: true, who };
  } catch {
    return { data: emptyData, header: emptyHeader, connected: false, who };
  }
}
