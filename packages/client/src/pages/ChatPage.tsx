import { useNavigate, useParams } from 'react-router-dom';
import ChatSurface from '../components/ChatSurface';

// The full-page "Ask the stash" view. All chat logic lives in ChatSurface,
// which is also hosted by the floating ChatDock; here we simply wire it to the
// router so the URL is the source of truth for the open conversation.
export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  return (
    <ChatSurface
      variant="page"
      convId={id}
      onConvIdChange={(cid, opts) => navigate(cid ? `/chat/${cid}` : '/chat', { replace: opts?.replace })}
    />
  );
}
