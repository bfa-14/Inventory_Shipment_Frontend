import { useEffect, useRef, useState } from 'react'
import { AspectRatio, Box, Button, Card, Center, Group, Image, Skeleton, Stack, Text } from '@mantine/core'
import { IconPhoto, IconTrash, IconUpload } from '@tabler/icons-react'
import { itemsApi } from '../../api/inventory/items'
import type { ItemFileDto } from '../../api/types'
import { notify } from '../../components/ui/notify'
import { fileRejection, formatBytes, IMAGE_ACCEPT, MAX_FILE_BYTES } from './itemFiles'

interface ItemImageCardProps {
  /** Null while the item does not exist yet; the picked file is then held until it is saved. */
  itemId: number | null
  /** The stored image, when the item has one. */
  image: ItemFileDto | undefined
  /** An image chosen but not uploaded yet - a new item, or one being edited. */
  pending: File | null
  editable: boolean
  onPick(file: File | null): void
  /** Removes the stored image; absent while the item is unsaved. */
  onRemove?(): void
  removing?: boolean
}

/**
 * The item's picture. The bytes come from an authenticated endpoint, so they are fetched as a Blob
 * and shown through an object URL rather than a plain `<img src>` an `<img>` could not authorize.
 */
export function ItemImageCard({
  itemId,
  image,
  pending,
  editable,
  onPick,
  onRemove,
  removing = false,
}: ItemImageCardProps) {
  const [storedUrl, setStoredUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const imageId = image?.id ?? null

  // The stored image. Fetching bytes and minting an object URL is the "synchronize with an external
  // system" case the set-state rule exempts: the blob and its URL live in the browser, not in React,
  // and the spinner has to be on screen before the await rather than a render later.
  useEffect(() => {
    if (itemId === null || imageId === null) {
      // eslint-disable-next-line react/set-state-in-effect
      setStoredUrl(null)
      // eslint-disable-next-line react/set-state-in-effect
      setFailed(false)
      return
    }

    const controller = new AbortController()
    let url: string | null = null
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true)
    // eslint-disable-next-line react/set-state-in-effect
    setFailed(false)

    void (async () => {
      try {
        const blob = await itemsApi.fileBlob(itemId, imageId, controller.signal)
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setStoredUrl(url)
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => {
      controller.abort()
      // The object URL pins the blob in memory until it is revoked.
      if (url) URL.revokeObjectURL(url)
    }
  }, [itemId, imageId])

  // The image the reader just picked, previewed before it is uploaded. Same exemption as above: the
  // object URL is a handle into the browser's own registry, and it has to be revoked when it goes.
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!pending) {
      // eslint-disable-next-line react/set-state-in-effect
      setPendingUrl(null)
      return
    }
    const url = URL.createObjectURL(pending)
    // eslint-disable-next-line react/set-state-in-effect
    setPendingUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pending])

  function choose(file: File | undefined) {
    // Clearing the input lets the same file be picked again after a rejection.
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return

    const rejection = fileRejection(file, 'image')
    if (rejection) {
      notify.error(rejection)
      return
    }
    onPick(file)
  }

  const shown = pendingUrl ?? storedUrl

  return (
    <Card radius="lg" p="lg" withBorder>
      <Text fw={600} fz="md" mb="sm">
        Item Image
      </Text>

      <AspectRatio ratio={4 / 3} mb="sm">
        {loading ? (
          <Skeleton radius="md" />
        ) : shown ? (
          <Image
            src={shown}
            alt={pending?.name ?? image?.fileName ?? 'Item image'}
            fit="contain"
            radius="md"
            bg="var(--mantine-color-gray-0)"
          />
        ) : (
          <Center
            bg="var(--mantine-color-gray-0)"
            style={{
              borderRadius: 'var(--mantine-radius-md)',
              border: '1px dashed var(--mantine-color-gray-4)',
            }}
          >
            <Stack gap={4} align="center">
              <IconPhoto size={34} color="var(--mantine-color-gray-5)" stroke={1.4} />
              <Text c="dimmed" fz="xs">
                {failed ? 'The image could not be loaded' : 'No image'}
              </Text>
            </Stack>
          </Center>
        )}
      </AspectRatio>

      {pending ? (
        <Text c="dimmed" fz="xs" mb="xs">
          {pending.name} ({formatBytes(pending.size)}) - uploaded when you save.
        </Text>
      ) : image ? (
        <Text c="dimmed" fz="xs" mb="xs">
          {image.fileName} ({formatBytes(image.sizeBytes)})
        </Text>
      ) : null}

      {editable ? (
        <Box>
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            hidden
            aria-hidden
            tabIndex={-1}
            onChange={(event) => choose(event.currentTarget.files?.[0])}
          />
          <Group gap="xs" wrap="wrap">
            <Button
              variant="light"
              size="xs"
              leftSection={<IconUpload size={15} />}
              onClick={() => inputRef.current?.click()}
            >
              {shown ? 'Replace image' : 'Upload image'}
            </Button>

            {pending ? (
              <Button variant="subtle" color="gray" size="xs" onClick={() => onPick(null)}>
                Discard
              </Button>
            ) : image && onRemove ? (
              <Button
                variant="subtle"
                color="red"
                size="xs"
                leftSection={<IconTrash size={15} />}
                loading={removing}
                onClick={onRemove}
              >
                Remove
              </Button>
            ) : null}
          </Group>
          <Text c="dimmed" fz="xs" mt={6}>
            JPEG, PNG or WebP, up to {formatBytes(MAX_FILE_BYTES)}.
          </Text>
        </Box>
      ) : null}
    </Card>
  )
}
