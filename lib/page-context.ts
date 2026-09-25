import {
  ensureRepositoryRow,
  getBoardData,
  getRepoHeader,
  type BoardData,
  type RepoHeader,
} from "@/lib/board-service";
import { getVerifiedRepository } from "@/lib/github/access";

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
}> {
  const verified = await getVerifiedRepository();
  if (!verified) return { data: emptyData, header: emptyHeader, connected: false };
  try {
    await ensureRepositoryRow(verified);
    const data = getBoardData(boardId);
    if (!data.repository ||
      data.repository.owner.toLowerCase() !== verified.owner.toLowerCase() ||
      data.repository.name.toLowerCase() !== verified.name.toLowerCase()) {
      return { data: emptyData, header: emptyHeader, connected: false };
    }
    return { data, header: getRepoHeader(), connected: true };
  } catch {
    return { data: emptyData, header: emptyHeader, connected: false };
  }
}
