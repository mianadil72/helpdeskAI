import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useLocation, useSearchParams } from 'react-router'
import {
  createColumnHelper,
  functionalUpdate,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type PaginationState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import {
  TICKET_CATEGORIES,
  TICKET_PAGE_SIZES,
  TICKET_STATUSES,
  ticketListQuerySchema,
  type TicketListItem,
  type TicketListQuery,
  type TicketSortField,
  type TicketsResponse,
} from '@helpdesk/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiGet } from '@/lib/api'
import { ticketCategoryLabels, ticketStatusBadge, ticketStatusLabels } from '@/lib/tickets'

const features = tableFeatures({ rowSortingFeature, rowPaginationFeature })
const column = createColumnHelper<typeof features, TicketListItem>()

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Sorting and paging happen on the server; only the date columns can sort.
const columns = column.columns([
  column.accessor('subject', {
    header: 'Subject',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <TicketLink id={row.original.id}>{row.original.subject}</TicketLink>
        <span className="text-xs text-muted-foreground">
          {row.original.messageCount === 1 ? '1 message' : `${row.original.messageCount} messages`}
        </span>
      </div>
    ),
  }),
  column.accessor('requesterEmail', {
    header: 'Requester',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex flex-col">
        {row.original.requesterName && <span>{row.original.requesterName}</span>}
        <span className="text-xs text-muted-foreground">{row.original.requesterEmail}</span>
      </div>
    ),
  }),
  column.accessor('status', {
    header: 'Status',
    enableSorting: false,
    cell: ({ getValue }) => (
      <Badge variant={ticketStatusBadge[getValue()]}>{ticketStatusLabels[getValue()]}</Badge>
    ),
  }),
  column.accessor('category', {
    header: 'Category',
    enableSorting: false,
    cell: ({ getValue }) => ticketCategoryLabels[getValue()],
  }),
  column.accessor((ticket) => ticket.assignee?.name, {
    id: 'assignee',
    header: 'Assignee',
    enableSorting: false,
    cell: ({ getValue }) =>
      getValue() ?? <span className="text-muted-foreground">Unassigned</span>,
  }),
  column.accessor('createdAt', {
    header: 'Created',
    sortDescFirst: true,
    cell: ({ getValue }) => dateTime.format(new Date(getValue())),
  }),
  column.accessor('updatedAt', {
    header: 'Updated',
    sortDescFirst: true,
    cell: ({ getValue }) => dateTime.format(new Date(getValue())),
  }),
])

// Remembers the list's filters so the detail page can link back to them.
function TicketLink({ id, children }: { id: string; children: string }) {
  const { search } = useLocation()
  return (
    <Link
      to={`/tickets/${encodeURIComponent(id)}`}
      state={{ listSearch: search }}
      className="font-medium hover:underline"
    >
      {children}
    </Link>
  )
}

const noTickets: TicketListItem[] = []
const ALL = 'all' // Radix Select can't use '' as an item value.

// Filters, search, sorting and page live in the URL, so they survive reloads
// and back/forward, and can be shared as links.
function useTicketListQuery() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = ticketListQuerySchema.parse(Object.fromEntries(searchParams))

  function update(patch: Partial<TicketListQuery>) {
    const next = { ...query, ...patch }
    // Defaults are left out to keep URLs short.
    const defaults = ticketListQuerySchema.parse({})
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(next)) {
      if (value !== undefined && value !== defaults[key as keyof TicketListQuery]) {
        params.set(key, String(value))
      }
    }
    setSearchParams(params)
  }

  return [query, update] as const
}

export function TicketsPage() {
  const [query, setQuery] = useTicketListQuery()

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['tickets', query],
    queryFn: () => apiGet<TicketsResponse>(`/api/tickets?${new URLSearchParams(toParams(query))}`),
    // Keep showing the current page while the next one loads.
    placeholderData: keepPreviousData,
  })

  const sorting: SortingState = [{ id: query.sort, desc: query.order === 'desc' }]
  const pagination: PaginationState = { pageIndex: query.page - 1, pageSize: query.pageSize }

  const table = useTable({
    features,
    columns,
    data: data?.tickets ?? noTickets,
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
    rowCount: data?.total ?? 0,
    getRowId: (ticket) => ticket.id,
    state: { sorting, pagination },
    onSortingChange: (updater: Updater<SortingState>) => {
      const [first] = functionalUpdate(updater, sorting)
      if (!first) return
      setQuery({ sort: first.id as TicketSortField, order: first.desc ? 'desc' : 'asc', page: 1 })
    },
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = functionalUpdate(updater, pagination)
      const pageSizeChanged = next.pageSize !== pagination.pageSize
      setQuery({ page: pageSizeChanged ? 1 : next.pageIndex + 1, pageSize: next.pageSize })
    },
  })

  const total = data?.total ?? 0
  const firstRow = total === 0 ? 0 : (query.page - 1) * query.pageSize + 1
  const lastRow = Math.min(query.page * query.pageSize, total)
  const filtered = Boolean(query.status || query.category || query.q)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tickets</h1>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query.q ?? ''} onChange={(q) => setQuery({ q: q || undefined, page: 1 })} />
        <Select
          value={query.status ?? ALL}
          onValueChange={(value) =>
            setQuery({ status: value === ALL ? undefined : (value as TicketListQuery['status']), page: 1 })
          }
        >
          <SelectTrigger aria-label="Status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {TICKET_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {ticketStatusLabels[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={query.category ?? ALL}
          onValueChange={(value) =>
            setQuery({
              category: value === ALL ? undefined : (value as TicketListQuery['category']),
              page: 1,
            })
          }
        >
          <SelectTrigger aria-label="Category" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {TICKET_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {ticketCategoryLabels[category]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setQuery({ status: undefined, category: undefined, q: undefined, page: 1 })}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading tickets…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load tickets: {error.message}
        </p>
      )}
      {data && (
        <>
          <Table aria-busy={isFetching} className={isFetching ? 'opacity-60' : undefined}>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted()
                    return (
                      <TableHead
                        key={header.id}
                        aria-sort={
                          sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                        }
                      >
                        {header.column.getCanSort() ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="-ml-2.5"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <table.FlexRender header={header} />
                            {sorted === 'asc' && <ArrowUp />}
                            {sorted === 'desc' && <ArrowDown />}
                          </Button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                    {total > 0
                      ? 'No tickets on this page.'
                      : filtered
                        ? 'No tickets match these filters.'
                        : 'No tickets yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getAllCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted-foreground">
              {total === 0 ? '0 tickets' : `${firstRow}–${lastRow} of ${total} tickets`}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Rows per page</span>
              <Select
                value={String(query.pageSize)}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger aria-label="Rows per page" size="sm" className="w-18">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">
                Page {query.page} of {Math.max(table.getPageCount(), 1)}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous page"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next page"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function toParams(query: TicketListQuery): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )
}

// Search box that updates the URL 300 ms after typing stops.
function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value)
  const sent = useRef(value)
  const send = useEffectEvent((trimmed: string) => {
    sent.current = trimmed
    onChange(trimmed)
  })

  // Follow outside changes (back/forward, Clear filters), but not our own.
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value
      setText(value)
    }
  }, [value])

  useEffect(() => {
    const trimmed = text.trim()
    if (trimmed === sent.current) return
    const timer = setTimeout(() => send(trimmed), 300)
    return () => clearTimeout(timer)
  }, [text])

  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Search tickets"
        placeholder="Search subject or requester"
        className="pl-8"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </div>
  )
}
