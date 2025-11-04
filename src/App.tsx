import "./App.css";
import { useState, useEffect } from "react";
import type { RulesResult } from "./types";
import {
  SkeletonText,
  Card,
  Heading,
  Text,
  List,
  Badge,
  Box,
  Stack,
  Spinner,
  For,
} from "@chakra-ui/react";

// Loading phase states
type LoadingPhase =
  | "idle"
  | "extracting"
  | "analyzing"
  | "summarizing"
  | "complete";

function App() {
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [partResult, setPartResult] = useState<RulesResult | null>(null);
  const [bullets, setBullets] = useState<string[] | null>(null);

  async function sendAnalyzeRequest() {
    try {
      setError(null);
      setBullets(null);
      // Don't clear partResult - keep the old risk overview visible until new data arrives
      setLoadingPhase("extracting");

      const analyzeResponse = await chrome.runtime.sendMessage({
        type: "ANALYZE_REQUEST", //Receiver: SW
      });

      if (!analyzeResponse?.ok) {
        setError(analyzeResponse?.error || "Analysis failed");
        setLoadingPhase("idle");
      }
    } catch (err) {
      setError(String(err));
      setLoadingPhase("idle");
    }
  }

  useEffect(() => {
    const messageListener = (
      request: any,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: any) => void
    ) => {
      if (request.type === "ANALYZE_PARTIAL") {
        setPartResult(request.partial);
        setLoadingPhase("summarizing");
      } else if (request.type === "ANALYZE_COMPLETE") {
        if (request.bullets && Array.isArray(request.bullets)) {
          setBullets(request.bullets);
        }
        setLoadingPhase("complete");
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Helper to get severity color - custom palette
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "High":
        return "red"; // Will use custom red (#E67A7A)
      case "Medium":
        return "orange"; // Will use custom orange (#EAC8A6)
      case "Low":
        return "blue"; // Will use custom blue (#3D74B6)
      default:
        return "gray";
    }
  };

  // Helper to get loading message
  const getLoadingMessage = () => {
    switch (loadingPhase) {
      case "extracting":
        return "Extracting page content...";
      case "analyzing":
        return "Analyzing terms & conditions...";
      case "summarizing":
        return "Generating AI summary (this may take 1-2 min on first run)...";
      default:
        return "";
    }
  };

  const isLoading =
    loadingPhase === "extracting" ||
    loadingPhase === "analyzing" ||
    loadingPhase === "summarizing";

  return (
    <Box p={4} w="100%" maxW="100%" overflowY="auto" maxH="100vh" overflowX="hidden">
      <Stack gap={4} w="100%" maxW="100%">
        {/* Header */}
        <Box>
          <Heading size="lg" mb={2}>
            T&C Decoder
          </Heading>
          <Text fontSize="sm" color="gray.600">
            Analyze Terms & Conditions with AI-powered insights
          </Text>
        </Box>

        {/* Analyze Button */}
        <button
          onClick={sendAnalyzeRequest}
          disabled={isLoading}
          style={{
            padding: "14px 28px",
            background: isLoading ? "#9ca3af" : "#3D74B6",
            color: "white",
            border: "none",
            borderRadius: "12px",
            fontSize: "16px",
            fontWeight: "600",
            cursor: isLoading ? "not-allowed" : "pointer",
            opacity: isLoading ? 0.7 : 1,
            transition: "opacity 0.2s ease",
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              e.currentTarget.style.opacity = "0.9";
            }
          }}
          onMouseLeave={(e) => {
            if (!isLoading) {
              e.currentTarget.style.opacity = "1";
            }
          }}
        >
          {isLoading ? "Analyzing..." : "Analyze This Page"}
        </button>

        {/* Loading Indicator */}
        {isLoading && (
          <Card.Root>
            <Card.Body>
              <Stack gap={3} align="center">
                <Spinner size="lg" color="blue.500" />
                <Text fontSize="md" fontWeight="medium">
                  {getLoadingMessage()}
                </Text>
                <SkeletonText noOfLines={3} gap={2} w="100%" />
              </Stack>
            </Card.Body>
          </Card.Root>
        )}

        {/* Error Display */}
        {error && (
          <Card.Root borderColor="red.500" borderWidth={2}>
            <Card.Header>
              <Heading size="sm" color="red.600">
                Error
              </Heading>
            </Card.Header>
            <Card.Body>
              <Text color="red.700">{error}</Text>
            </Card.Body>
          </Card.Root>
        )}

        {/* Quick Risk Overview */}
        {partResult && (
          <Card.Root style={{ borderColor: "#3D74B6", borderWidth: "2px" }}>
            <Card.Header>
              <Heading size="md">Risk Overview</Heading>
            </Card.Header>
            <Card.Body>
              <Stack gap={3}>
                <Box>
                  <Text fontSize="sm" color="gray.600" mb={1}>
                    Overall Severity
                  </Text>
                  <Badge
                    colorPalette={getSeverityColor(partResult.severity)}
                    size="lg"
                    fontSize="md"
                  >
                    {partResult.severity}
                  </Badge>
                </Box>

                {partResult.hero && (
                  <Box>
                    <Text fontSize="sm" color="gray.600" mb={1}>
                      Key Warning
                    </Text>
                    <Box
                      fontSize="md"
                      fontWeight="medium"
                      color="#8B4545"
                      bg="#faf5e5"
                      p={3}
                      borderRadius="md"
                      borderLeft="4px solid"
                      borderLeftColor="#E67A7A"
                    >
                      {partResult.hero}
                    </Box>
                  </Box>
                )}

                <Box>
                  <Text fontSize="sm" color="gray.600" mb={1}>
                    Data Sharing Level
                  </Text>
                  <Badge
                    colorPalette={getSeverityColor(partResult.heatmap.level)}
                    size="md"
                  >
                    {partResult.heatmap.level}
                  </Badge>
                  {partResult.heatmap.topRecipients.length > 0 && (
                    <Box mt={2}>
                      <Text fontSize="xs" color="gray.500" mb={1}>
                        Top recipients:
                      </Text>
                      <List.Root variant="plain">
                        <For each={partResult.heatmap.topRecipients}>
                          {(recipient) => (
                            <List.Item key={recipient.phrase}>
                              <Text fontSize="xs">
                                {recipient.phrase} ({recipient.count}×)
                              </Text>
                            </List.Item>
                          )}
                        </For>
                      </List.Root>
                    </Box>
                  )}
                </Box>
              </Stack>
            </Card.Body>
          </Card.Root>
        )}

        {/* AI Summary Section */}
        {bullets && bullets.length > 0 && (
          <>
            <Card.Root style={{ borderColor: "#3D74B6", borderWidth: "2px" }}>
              <Card.Header>
                <Stack direction="row" align="center" gap={2}>
                  <Heading size="md">AI Summary</Heading>
                  <Badge colorPalette="blue" size="sm">
                    Powered by Local AI
                  </Badge>
                </Stack>
              </Card.Header>
              <Card.Body>
                <Text fontSize="sm" color="gray.600" mb={3}>
                  Key points you should know about this agreement:
                </Text>
                <List.Root gap={3} variant="plain">
                  <For each={bullets.slice(0, 5)}>
                    {(bullet, index) => (
                      <List.Item key={index}>
                        <Badge colorPalette="red" size="lg" variant="subtle" p={3} borderRadius="md" width="100%" style={{ wordBreak: "break-word", whiteSpace: "normal", display: "block" }}>
                          <Text fontSize="sm" lineHeight="tall" style={{ wordBreak: "break-word", whiteSpace: "normal" }}>
                            {bullet}
                          </Text>
                        </Badge>
                      </List.Item>
                    )}
                  </For>
                </List.Root>
              </Card.Body>
            </Card.Root>

            {/* Calendar Reminder Button */}
            <button
              onClick={() => {
                // Get current page title
                const pageTitle = document.title || "Subscription";

                // Calculate date 30 days from now
                const reminderDate = new Date();
                reminderDate.setDate(reminderDate.getDate() + 30);

                // Format date for Google Calendar (YYYYMMDDTHHMMSSZ)
                const formatDateForGCal = (date: Date) => {
                  const year = date.getFullYear();
                  const month = String(date.getMonth() + 1).padStart(2, '0');
                  const day = String(date.getDate()).padStart(2, '0');
                  return `${year}${month}${day}`;
                };

                const dateStr = formatDateForGCal(reminderDate);

                // Build Google Calendar URL
                const title = encodeURIComponent(`Cancel ${pageTitle} subscription`);
                const details = encodeURIComponent(`Reminder to cancel your ${pageTitle} subscription before auto-renewal.`);
                const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dateStr}/${dateStr}&details=${details}`;

                // Open in new tab
                window.open(gcalUrl, '_blank');
              }}
              style={{
                padding: "12px 24px",
                background: "#3D74B6",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontSize: "16px",
                fontWeight: "500",
                cursor: "pointer",
                transition: "opacity 0.2s ease",
                width: "100%",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              📅 Add Calendar Reminder (Cancel in 30 days)
            </button>
          </>
        )}

        {/* Waiting for Summary State */}
        {partResult && !bullets && loadingPhase === "summarizing" && (
          <Card.Root style={{ borderColor: "#EAC8A6", borderWidth: "1px" }}>
            <Card.Body>
              <Stack gap={2} align="center">
                <Spinner size="md" style={{ color: "#3D74B6" }} />
                <Text fontSize="sm" color="gray.600" textAlign="center">
                  AI is analyzing the contract...
                  <br />
                  <Text as="span" fontSize="xs" color="gray.500">
                    (First run may take 1-2 minutes to download the model)
                  </Text>
                </Text>
              </Stack>
            </Card.Body>
          </Card.Root>
        )}

        {/* Footer Info */}
        {loadingPhase === "complete" && (
          <Box pt={4} borderTop="1px solid" borderColor="gray.200">
            <Text fontSize="xs" color="gray.500" textAlign="center">
              Analysis complete. All processing happens locally on your device.
            </Text>
          </Box>
        )}
      </Stack>
    </Box>
  );
}

export default App;
