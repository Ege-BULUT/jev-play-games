import { notFound } from 'next/navigation';
import { GAMES, gameById } from '@/games';
import { PlayView } from '@/components/PlayView';

export function generateStaticParams() {
  return GAMES.map((g) => ({ game: g.id }));
}

export async function generateMetadata({ params }: PageProps<'/play/[game]'>) {
  const g = gameById((await params).game);
  return { title: g ? `${g.title} · Jev Play Games` : 'Jev Play Games' };
}

export default async function Page({ params, searchParams }: PageProps<'/play/[game]'>) {
  const { game } = await params;
  if (!gameById(game)) notFound();
  const { replay } = await searchParams;
  return <PlayView key={`${game}:${replay ?? ''}`} gameId={game} replayId={typeof replay === 'string' ? replay : undefined} />;
}
