import { Inbox, SearchX, Car, AlertCircle } from "lucide-react"
import { cn } from "../../lib/utils"

const icons = {
  inbox: Inbox,
  search: SearchX,
  car: Car,
  alert: AlertCircle,
}

function EmptyState({ icon = "inbox", title, description, action, className }) {
  const Icon = icons[icon] || Inbox
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Icon className="h-7 w-7 text-muted-foreground/60" />
      </div>
      <h3 className="mb-1 text-sm font-semibold text-foreground">{title || "Nothing here yet"}</h3>
      {description && (
        <p className="mb-4 max-w-xs text-xs text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  )
}

export { EmptyState }
