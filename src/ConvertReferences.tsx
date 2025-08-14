import React, { useState, useCallback } from 'react'
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Select,
  Stack,
  Text,
  TextArea,
  TextInput,
  Checkbox,
  Badge,
  Spinner,
  Toast
} from '@sanity/ui'
import { TransferIcon, SearchIcon } from '@sanity/icons'
import { SanityClient } from 'sanity'

export interface ConvertReferencesProps {
  client: SanityClient
  documentTypes?: string[]
  onComplete?: (results: ConversionResult) => void
  onError?: (error: string) => void
  batchSize?: number
  dryRun?: boolean
  maxDocuments?: number
}

export interface ConversionResult {
  converted: number
  errors: string[]
  spaceSaved: number
}

const ConvertReferences: React.FC<ConvertReferencesProps> = ({
  client,
  documentTypes = [],
  onComplete,
  onError,
  batchSize = 10,
  dryRun = false,
  maxDocuments = 1000
}) => {
  const [selectedType, setSelectedType] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [useCustomQuery, setUseCustomQuery] = useState(false)
  const [customGroqQuery, setCustomGroqQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [documents, setDocuments] = useState<any[]>([])
  const [strongRefs, setStrongRefs] = useState<any[]>([])
  const [message, setMessage] = useState('')
  const [conversionType, setConversionType] = useState<'strong-to-weak' | 'weak-to-strong'>('strong-to-weak')

  const scanForReferences = useCallback(async () => {
    if (!client) return
    
    setIsScanning(true)
    setMessage('Scanning for documents with references...')
    
    try {
      let query = ''
      
      if (useCustomQuery && customGroqQuery) {
        query = customGroqQuery
      } else {
        const typeFilter = selectedType ? `_type == "${selectedType}"` : 'defined(_type)'
        const searchFilter = searchQuery ? ` && (title match "*${searchQuery}*" || name match "*${searchQuery}*")` : ''
        query = `*[${typeFilter}${searchFilter}][0...${maxDocuments}]`
      }
      
      const docs = await client.fetch(query)
      setDocuments(docs)
      
      // Analyze references in documents
      const refsToConvert: any[] = []
      
      for (const doc of docs) {
        const refs = findReferences(doc, conversionType)
        if (refs.length > 0) {
          refsToConvert.push({
            document: doc,
            references: refs,
            refCount: refs.length
          })
        }
      }
      
      setStrongRefs(refsToConvert)
      setMessage(`Found ${refsToConvert.length} documents with ${conversionType === 'strong-to-weak' ? 'strong' : 'weak'} references to convert`)
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Scan failed'
      setMessage(`Scan error: ${errorMessage}`)
      onError?.(errorMessage)
    } finally {
      setIsScanning(false)
    }
  }, [client, selectedType, searchQuery, useCustomQuery, customGroqQuery, maxDocuments, conversionType, onError])

  const findReferences = (obj: any, type: 'strong-to-weak' | 'weak-to-strong', path = ''): any[] => {
    const refs: any[] = []
    
    if (!obj || typeof obj !== 'object') return refs
    
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        refs.push(...findReferences(item, type, `${path}[${index}]`))
      })
    } else {
      Object.keys(obj).forEach(key => {
        const value = obj[key]
        const currentPath = path ? `${path}.${key}` : key
        
        if (value && typeof value === 'object') {
          // Check if this is a reference object
          if (type === 'strong-to-weak' && value._type === 'reference' && value._ref) {
            // Strong reference found
            refs.push({
              path: currentPath,
              type: 'strong',
              ref: value._ref,
              weak: value._weak || false
            })
          } else if (type === 'weak-to-strong' && value._type === 'reference' && value._ref && value._weak) {
            // Weak reference found
            refs.push({
              path: currentPath,
              type: 'weak',
              ref: value._ref,
              weak: true
            })
          } else {
            // Recurse into nested objects
            refs.push(...findReferences(value, type, currentPath))
          }
        }
      })
    }
    
    return refs
  }

  const convertReferences = useCallback(async () => {
    if (!client || strongRefs.length === 0) return
    
    setIsLoading(true)
    setMessage('Converting references...')
    
    try {
      let converted = 0
      const errors: string[] = []
      let spaceSaved = 0
      
      for (let i = 0; i < strongRefs.length; i += batchSize) {
        const batch = strongRefs.slice(i, i + batchSize)
        
        for (const item of batch) {
          try {
            const { document: doc, references } = item
            
            if (!dryRun) {
              // Create patches for each reference
              const patches: any[] = []
              
              references.forEach((ref: any) => {
                if (conversionType === 'strong-to-weak') {
                  // Convert strong to weak reference
                  patches.push({
                    path: ref.path,
                    value: {
                      _type: 'reference',
                      _ref: ref.ref,
                      _weak: true
                    }
                  })
                } else {
                  // Convert weak to strong reference
                  patches.push({
                    path: ref.path,
                    value: {
                      _type: 'reference',
                      _ref: ref.ref
                      // Remove _weak property
                    }
                  })
                }
              })
              
              // Apply patches
              let patchBuilder = client.patch(doc._id)
              patches.forEach(patch => {
                patchBuilder = patchBuilder.set({ [patch.path]: patch.value })
              })
              
              await patchBuilder.commit()
            }
            
            converted++
            // Estimate space saved (weak references are slightly smaller)
            if (conversionType === 'strong-to-weak') {
              spaceSaved += references.length * 20 // Rough estimate in bytes
            }
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Conversion failed'
            errors.push(`Failed to convert ${item.document._id}: ${errorMessage}`)
          }
        }
        
        setMessage(`${dryRun ? 'Would convert' : 'Converted'} ${converted}/${strongRefs.length} documents...`)
      }
      
      const result: ConversionResult = {
        converted,
        errors,
        spaceSaved
      }
      
      setMessage(`${dryRun ? 'Dry run complete' : 'Conversion complete'}: ${converted} documents processed`)
      onComplete?.(result)
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Conversion failed'
      setMessage(`Conversion error: ${errorMessage}`)
      onError?.(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }, [client, strongRefs, batchSize, dryRun, conversionType, onComplete, onError])

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <Card padding={4}>
      <Stack space={4}>
        <Heading size={2}>Convert References</Heading>
        
        <Text size={1} muted>
          Convert between strong and weak references to optimize performance and reduce bundle size.
        </Text>

        {/* Conversion Type */}
        <Card padding={3} tone="primary">
          <Stack space={3}>
            <Text weight="semibold">Conversion Type</Text>
            <Flex gap={3}>
              <Button
                mode={conversionType === 'strong-to-weak' ? 'default' : 'ghost'}
                icon={TransferIcon}
                text="Strong → Weak"
                onClick={() => setConversionType('strong-to-weak')}
              />
              <Button
                mode={conversionType === 'weak-to-strong' ? 'default' : 'ghost'}
                icon={TransferIcon}
                text="Weak → Strong"
                onClick={() => setConversionType('weak-to-strong')}
              />
            </Flex>
            <Text size={1} muted>
              {conversionType === 'strong-to-weak' 
                ? 'Convert strong references to weak references (recommended for performance)'
                : 'Convert weak references to strong references (ensures referential integrity)'
              }
            </Text>
          </Stack>
        </Card>

        {/* Document Type Selection */}
        <Stack space={2}>
          <Text weight="semibold">Document Type</Text>
          <Select
            value={selectedType}
            onChange={(event) => setSelectedType(event.currentTarget.value)}
          >
            <option value="">All document types</option>
            {documentTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </Select>
        </Stack>

        {/* Search Configuration */}
        <Stack space={3}>
          <Text weight="semibold">Search Configuration</Text>
          
          <Checkbox
            checked={useCustomQuery}
            onChange={(event) => setUseCustomQuery(event.currentTarget.checked)}
          >
            Use custom GROQ query
          </Checkbox>
          
          {useCustomQuery ? (
            <TextArea
              placeholder="Enter GROQ query (e.g., *[_type == 'post' && defined(author)])..."
              value={customGroqQuery}
              onChange={(event) => setCustomGroqQuery(event.currentTarget.value)}
              rows={3}
            />
          ) : (
            <TextInput
              placeholder="Search in title, name, or other fields..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyPress={(event) => event.key === 'Enter' && scanForReferences()}
            />
          )}
          
          <Button
            text="Scan for References"
            onClick={scanForReferences}
            disabled={isScanning || isLoading}
            tone="primary"
            icon={SearchIcon}
          />
        </Stack>

        {/* Results */}
        {strongRefs.length > 0 && (
          <Card padding={3} tone="transparent">
            <Stack space={3}>
              <Flex align="center" gap={2}>
                <Text weight="semibold">Documents with References</Text>
                <Badge tone="primary">{strongRefs.length} documents</Badge>
                <Badge tone="caution">
                  {strongRefs.reduce((sum, item) => sum + item.refCount, 0)} references
                </Badge>
              </Flex>
              
              <Box style={{ maxHeight: '200px', overflow: 'auto' }}>
                <Stack space={2}>
                  {strongRefs.slice(0, 10).map((item, index) => (
                    <Card key={item.document._id || index} padding={2} tone="default">
                      <Flex justify="space-between" align="center">
                        <Text size={1}>
                          <strong>{item.document._type}</strong>: {item.document.title || item.document.name || item.document._id}
                        </Text>
                        <Badge tone="primary">{item.refCount} refs</Badge>
                      </Flex>
                    </Card>
                  ))}
                  {strongRefs.length > 10 && (
                    <Text size={1} muted>...and {strongRefs.length - 10} more documents</Text>
                  )}
                </Stack>
              </Box>
              
              <Button
                text={dryRun ? 'Preview Conversion' : 'Convert References'}
                onClick={convertReferences}
                disabled={isLoading || isScanning}
                tone={conversionType === 'strong-to-weak' ? 'positive' : 'caution'}
                icon={TransferIcon}
              />
            </Stack>
          </Card>
        )}

        {/* Status */}
        {(isLoading || isScanning || message) && (
          <Card padding={3} tone={isLoading || isScanning ? 'primary' : 'positive'}>
            <Flex align="center" gap={2}>
              {(isLoading || isScanning) && <Spinner />}
              <Text>{message}</Text>
            </Flex>
          </Card>
        )}

        {/* Settings */}
        <Card padding={3} tone="transparent">
          <Stack space={2}>
            <Text weight="semibold" size={1}>Settings</Text>
            <Flex gap={3} align="center">
              <Checkbox checked={dryRun} readOnly>
                Dry run mode: {dryRun ? 'ON' : 'OFF'}
              </Checkbox>
              <Text size={1} muted>Batch size: {batchSize}</Text>
              <Text size={1} muted>Max documents: {maxDocuments}</Text>
            </Flex>
          </Stack>
        </Card>

        {/* Info */}
        <Card padding={3} tone="transparent">
          <Stack space={2}>
            <Text weight="semibold" size={1}>About Reference Types</Text>
            <Text size={1} muted>
              <strong>Strong references:</strong> Maintain referential integrity but can impact performance with large datasets.
            </Text>
            <Text size={1} muted>
              <strong>Weak references:</strong> Better performance and smaller bundle size, but referenced documents can be deleted without updating the reference.
            </Text>
          </Stack>
        </Card>
      </Stack>
    </Card>
  )
}

export default ConvertReferences